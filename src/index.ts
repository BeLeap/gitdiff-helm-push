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
  github: GithubContext;
  chartmuseum: ChartmuseumContext;
}

async function prepareContext(actions: ActionsContext): Promise<CustomContext> {
  const customContext: CustomContext = {
    actions: actions,
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

async function build(dir: string): Promise<number | void> {
    let buildCmdOptions: exec.ExecOptions = {}; 
    let buildStderr = "";
    buildCmdOptions.listeners = {
      stderr: (data: Buffer) => {
        buildStderr += data.toString();
      },
    };

    return exec.exec("helm", ["dependency", "build",  dir], buildCmdOptions)
            .catch(() => {
              core.error(buildStderr);
              core.setFailed(`${dir} build failed`);
            });
}

async function lint(dir: string): Promise<number | void> {
    let lintCmdOptions: exec.ExecOptions = {}; 
    let lintStdout = "";
    lintCmdOptions.listeners = {
      stdout: (data: Buffer) => {
        lintStdout += data.toString();
      },
    };

    return exec.exec("helm", ["lint", dir], lintCmdOptions)
            .catch(() => {
              core.error(`${dir} lint failed`);
            }).finally(() => {
              core.info(lintStdout);
            });
}

async function push(ctx: CustomContextWithOctokit, dir: string): Promise<any> {
    let pushCmdOptions: exec.ExecOptions = {}; 
    let pushStderr = "";
    pushCmdOptions.listeners = {
      stderr: (data: Buffer) => {
        pushStderr += data.toString();
      },
    };

    return exec.exec("helm", ["cm-push", dir, "chartmuseum"], pushCmdOptions)
            .then(() => {
              const chartInfo: { name: string, version: string } = yaml.load(fs.readFileSync(`${dir}/Chart.yaml`, 'utf-8')) as any;
              return ctx.github.octokit.rest.git.createRef({
                ...ctx.actions.repo,
                ref: `refs/tags/${chartInfo.name}-${chartInfo.version}`,
                sha: ctx.actions.payload["after"],
              });
            })
            .catch(() => {
              core.error(pushStderr);
              core.setFailed(`${dir} push failed`);
            });
}

async function process(ctx: CustomContextWithOctokit,dir: string) {
  await build(dir);
  await lint(dir);
  await push(ctx, dir);
}

async function run() {
  const customContext = await prepareContext(context);
  core.debug(customContext.toString());

  if (customContext.actions.eventName !== "push") {
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
  await Promise.all(promises);
}

run();
