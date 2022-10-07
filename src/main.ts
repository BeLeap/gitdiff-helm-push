import * as core from "@actions/core";

async function run() {
  // Load acitons input
  const chartmuseumUrl = core.getInput("chartmuseum-url", { required: true });
  const chartmuseumUsername = core.getInput("chartmuseum-username", { required: true });
  const chartmuseumPassword = core.getInput("chartmuseum-password", { required: true });

  core.debug(JSON.stringify({ chartmuseumUrl, chartmuseumUsername, chartmuseumPassword }));
}

run();
