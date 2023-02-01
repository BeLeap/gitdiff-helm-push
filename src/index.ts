import * as core from "@actions/core";
import { context, getOctokit } from "@actions/github";
import path from "path";
import * as exec from "@actions/exec";
import * as yaml from "js-yaml";
import * as fs from "fs";
import { GitHub } from "@actions/github/lib/utils";

type ActionsContext = typeof context;

type GithubContext = { token: string };
type GithubContextWithOctokit = GithubContext & { octokit: InstanceType<typeof GitHub> };

type ChartmuseumContext = {
  url: string;
  username: string;
  password: string;
};

type CustomContext = {
  actions: ActionsContext;
  mode: "push" | "check";
  github: GithubContext;
  chartmuseum: ChartmuseumContext;
}

async function prepareContext(actions: ActionsContext): Promise<CustomContext> {
  const customContext: CustomContext = {
    actions: actions,
    mode: core.getInput("mode", { required: true }) === "check" ? "check" : "push",
    github: {
      token: core.getInput("github-token"),
    },
    chartmuseum: {
      url: core.getInput("chartmuseum-url", { required: true }),
      username: core.getInput("chartmuseum-username", { required: true }),
      password: core.getInput("chartmuseum-password", { required: true }),
    },
  };
  core.setSecret(customContext.chartmuseum.password);

  return customContext;
}

type CustomContextWithOctokit = CustomContext & { github: GithubContextWithOctokit }
async function buildEnv(customContext: CustomContext): Promise<CustomContextWithOctokit> {
  const octokit = getOctokit(customContext.github.token);

  core.debug("Install helm");
  await exec.exec("curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3");
  await exec.exec("chmod 700 get_helm.sh");
  await exec.exec("./get_helm.sh");
  core.debug("Installed helm");

  try {
    await exec.exec("helm plugin install https://github.com/chartmuseum/helm-push");
    core.debug("Installed helm-push plugin");
  } catch (err) {
    core.info("Failed to install helm-push plugin: maybe already exists");
  }

  core.debug("Add chartmuseum");
  await exec.exec(`helm repo add chartmuseum ${customContext.chartmuseum.url} --username ${customContext.chartmuseum.username} --password ${customContext.chartmuseum.password}`);

  return {
    ...customContext,
    github: {
      ...customContext.github,
      octokit,
    },
  }
}

async function build(dir: string): Promise<void> {
    let buildCmdOptions: exec.ExecOptions = {}; 
    let buildStderr = "";
    buildCmdOptions.listeners = {
      stderr: (data: Buffer) => {
        buildStderr += data.toString();
      },
    };

    try {
      await exec.exec("helm", ["dependency", "build",  dir], buildCmdOptions);
    } catch (error) {
      core.error(buildStderr);
      throw error;
    }
}

async function lint(dir: string): Promise<void> {
    let lintCmdOptions: exec.ExecOptions = {}; 
    let lintStdout = "";
    lintCmdOptions.listeners = {
      stdout: (data: Buffer) => {
        lintStdout += data.toString();
      },
    };

    try {
      await exec.exec("helm", ["lint", dir], lintCmdOptions);
    } catch {
      core.warning(`${dir} lint failed`);
    } finally {
      core.info(lintStdout);
    }
}

async function push(dir: string): Promise<void> {
    let pushCmdOptions: exec.ExecOptions = {}; 
    let pushStderr = "";
    pushCmdOptions.listeners = {
      stderr: (data: Buffer) => {
        pushStderr += data.toString();
      },
    };

    try {
      await exec.exec("helm", ["cm-push", dir, "chartmuseum"], pushCmdOptions);
    } catch (error) {
      core.error(pushStderr);
      throw error;
    }
}

async function tag(ctx: CustomContextWithOctokit, dir: string): Promise<void> {
  const chartInfo: { name: string, version: string } = yaml.load(fs.readFileSync(`${dir}/Chart.yaml`, 'utf-8')) as any;
  await ctx.github.octokit.rest.git.createRef({
    ...ctx.actions.repo,
    ref: `refs/tags/${chartInfo.name}-${chartInfo.version}`,
    sha: ctx.actions.payload["after"],
  });
}

async function process(ctx: CustomContextWithOctokit, dir: string): Promise<void> {
    await build(dir)
    await lint(dir);

    if (ctx.mode === "push") {
      await push(dir);
      await tag(ctx, dir);
    }
}

async function run() {
  const customContext = await prepareContext(context);
  core.debug(customContext.toString());

  if (customContext.actions.eventName !== "push" && customContext.mode === "push") {
    throw new Error(`${context.eventName} not supported`);
  }

  const ctx = await buildEnv(customContext);

  const { data: diffData } = await ctx.github.octokit.rest.repos.compareCommits({
    ...ctx.actions.repo,
    base: ctx.actions.payload["before"],
    head: ctx.actions.payload["after"],
  });
  core.debug(JSON.stringify(diffData.files));

  const diffingFiles = diffData.files ?? [];
  const diffingDirs = diffingFiles.filter(it => it.filename.includes("Chart.yaml")).map(it => path.dirname(it.filename))
  core.debug(JSON.stringify(diffingDirs));

  const promises = diffingDirs.map((it) => process(ctx, it));
  await Promise.allSettled(promises).then((results) => {
    results.forEach((result) => {
      if (result.status === "rejected") {
        core.setFailed(result.reason);
        throw result.reason;
      }
    });
  });
}

run();
