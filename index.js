const path = require("path");
const { execFile, fork } = require("child_process");
const { app, shell, dialog } = require("electron");
const waitOn = require("wait-on");
const { URL } = require("url");
const respawn = require("respawn");
const fetch = require("node-fetch");
const tcpPortUsed = require("tcp-port-used");
const { setEnvVars } = require("./envVars");
const { renderer } = require("./renderer");
const LMSIntegration = require("./lmsIntegration");

const isMac = process.platform === "darwin";
const isWin = process.platform === "win32";
const isDev = process.env.ELECTRON_DEV_MODE;
const isProd = !isDev;

const arch = process.arch; // Detect architecture (e.g., 'x64', 'arm64')
console.log(`Detected architecture: ${arch}`);

// Initialize LMS integration
async function initializeLMS() {
  const lmsIntegration = new LMSIntegration();
  const bearerToken = process.env.LMS_BEARER_TOKEN;
  if (!bearerToken) {
    console.error("LMS_BEARER_TOKEN environment variable is not set");
    return false;
  }
  const tokenStatus = lmsIntegration.getTokenStatus();
  //console.log('Current token status:', tokenStatus);

  const success = await lmsIntegration.initialize(bearerToken);

  if (success) {
    console.log("LMS integration initialized successfully");

    // Display final token status
    const finalStatus = lmsIntegration.getTokenStatus();
    console.log('Final token status:', finalStatus);
  } else {
    console.error("Failed to initialize LMS integration");
  }

  return success;
  //return false; // For testing purposes, return false to simulate failure
}

async function waitForUrls(
  urls,
  { interval = 250, auth = { username: "", password: "" } } = {}
) {
  console.log("Waiting for URLs:", urls);

  async function check(url) {
    console.log(`Checking URL: ${url}`);
    while (true) {
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: "Basic " + btoa(`${auth.username}:${auth.password}`),
          },
        });

        if (res.status === 200) {
          console.log(`URL is ready: ${url}`);
          return true;
        }
      } catch (error) {
        // console.error(`Error checking URL ${url}:`, error.message);
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  try {
    return await Promise.all(urls.map(check));
  } catch (error) {
    console.error("Error waiting for URLs:", error.message);
    throw error; // Re-throw to ensure the caller handles it
  }
}

async function main() {
  try {
    console.log(`Running in ${isDev ? "dev" : "prod"} mode`);

    await setEnvVars();
    //console.log("Environment variables set:", process.env);

    //LMS Integration
    const n8nAccess = await initializeLMS();
    if (!n8nAccess) {
      console.error("Failed to get n8n access. Exiting...");
      await showAccessDeniedDialog();
      process.exit(1);
    }
    console.log("LMS integration initialized successfully");

    const N8N_URL = `http://localhost:${process.env.N8N_PORT}`;
    const N8N_HEALTH_URL = `${N8N_URL}/healthz`;

    console.log("n8n URL:", N8N_URL);
    console.log("n8n Health URL:", N8N_HEALTH_URL);

    console.log("Starting n8n process...");

    // 🔍 Determine base path depending on environment
    const basePath = isDev ? __dirname : path.join(process.resourcesPath, "app.asar");
    const nodeModulesPath = path.join(basePath, "node_modules");
    const n8nScriptPath = path.join(nodeModulesPath, "n8n", "bin", "n8n");

    // 🧠 Log resolved paths
    console.log("Base path:", basePath);
    console.log("Node modules path:", nodeModulesPath);
    console.log("n8n script path:", n8nScriptPath);

    //const nodeModulesPath = path.join(__dirname, "node_modules");
    //const n8nScriptPath = path.join(nodeModulesPath, "n8n", "bin", "n8n");

    //console.log("Node modules path:", nodeModulesPath);
    //console.log("n8n script path:", n8nScriptPath);

    let n8nProcess;
    const controller = new AbortController();
    const { signal } = controller;

    const bgEnabled = process.env.N8N_DESKTOP_BACKGROUND_PROCESS_ENABLED === "true";
    const portInUse = await tcpPortUsed.check(parseInt(process.env.N8N_PORT));
    const shouldInit = !bgEnabled || !portInUse;
    const offlineEnabled = process.env.DESKTOP_ENABLE_OFFLINE_MODE === "true";

    console.log("Background process enabled:", bgEnabled);
    console.log("Port in use:", portInUse);
    console.log("Should initialize n8n process:", shouldInit);
    console.log("Offline mode enabled:", offlineEnabled);

    process.env.N8N_VERSION_NOTIFICATIONS_ENABLED = false;
    process.env.N8N_AUTH_EXCLUDE_ENDPOINTS = [
      "rest/oauth1-credential/callback",
      "rest/oauth2-credential/callback",
    ].join(":");

    if (isDev && shouldInit) {
      const devCliArgs = ["start", "--tunnel"];
      console.log("Dev CLI arguments:", devCliArgs);

      if (offlineEnabled) devCliArgs.pop();

      if (isMac) {
        console.log("Starting n8n process on macOS...");
        n8nProcess = execFile(n8nScriptPath, devCliArgs, { signal });
      }

      if (isWin) {
        console.log("Starting n8n process on Windows...");
        n8nProcess = fork(n8nScriptPath, devCliArgs, { signal });
      }
    }

    const isBinary = !n8nScriptPath.endsWith(".js");
    console.log("isBinary:", isBinary);
    if (isProd && shouldInit) {
      const prodCliArgs = isBinary ? [] : [n8nScriptPath, "start", "--tunnel"];
      console.log("Prod CLI arguments:", prodCliArgs);
      if (!isBinary && offlineEnabled) prodCliArgs.pop();
      const spawnArgs = isBinary ? [n8nScriptPath] : ["node", ...prodCliArgs];
      console.log("n8n process respawned with args:", spawnArgs);
      n8nProcess = respawn(spawnArgs, {
        name: "n8n",
        maxRestarts: 10,
        fork: true
      });
      n8nProcess.on("exit", (code, signal) => {
        console.log(`[n8n process exited] code: ${code}, signal: ${signal}`);
      });
      n8nProcess.on("error", (err) => {
        console.error(`[n8n process error] ${err}`);
      });
      // Watch child process output
      n8nProcess.on("spawn", () => {
        console.log("🐣 Child process spawned");
        const child = n8nProcess.child;
        if (child && child.stdout) {
          child.stdout.on("data", (data) => {
            console.log(`[n8n stdout]: ${data.toString()}`);
          });
        }
        if (child && child.stderr) {
          child.stderr.on("data", (data) => {
            console.error(`[n8n stderr]: ${data.toString()}`);
          });
        }
        child.on("exit", (code) => {
          console.warn(`⚠️ Child process exited with code: ${code}`);
        });
      });
      console.log("Starting n8n process in production mode...");
      n8nProcess.start();
    }

    if (n8nProcess) {
      n8nProcess.on("data", (data) => console.log("n8n process data:", data));
      n8nProcess.on("error", (error) => console.error("n8n process error:", error.message));
    }

    let urls = await waitForUrls([N8N_HEALTH_URL, N8N_URL], {
      timeout: 10000,
      interval: 250,
      auth: {
        username: process.env.N8N_BASIC_AUTH_USER,
        password: process.env.N8N_BASIC_AUTH_PASSWORD,
      },
    });

    console.log("URLs ready:", urls);

    console.log("n8n process ready");
    console.log(`Please check ${N8N_HEALTH_URL}`);

    console.log("Starting Electron main process...");

    app.whenReady().then(() => renderer(controller, bgEnabled));

    app.on("web-contents-created", (_, contents) => {
      console.log("Web contents created");

      contents.on("will-navigate", (event, targetUrl) => {
        console.log("Navigation detected to URL:", targetUrl);
        try {
          contents.destroy(); // TODO: undocumented API, find alternative
          event.preventDefault();

          const url = new URL(targetUrl);

          if (url.hostname === "localhost") {
            console.log("Navigating to localhost URL:", targetUrl);
            window.loadURL(targetUrl).catch((error) =>
              console.error("Error loading URL:", error.message)
            );
            return;
          }

          if (!["https:", "http:"].includes(url.protocol)) {
            console.log("Blocked navigation to non-HTTP/HTTPS URL:", targetUrl);
            return; // for security
          }

          console.log("Opening external URL:", targetUrl);
          shell.openExternal(targetUrl);
        } catch (error) {
          console.error("Error handling navigation:", error.message);
        }
      });
    });
  } catch (error) {
    console.error("Error in main function:", error.message);
    process.exit(1);
  }
}

async function showAccessDeniedDialog() {
  try {
    await app.whenReady();

    const result = await dialog.showMessageBox({
      type: "error",
      title: "Access Denied",
      message: "You do not have access to N8N",
      detail:
        "Please contact your administrator for access or check your credentials.",
      buttons: ["OK"],
      defaultId: 0,
      cancelId: 0,
      icon: "../assets/icon.png",
    });

    console.log("Access denied, dialog closed");
    return result;
  } catch (error) {
    console.error("Error showing access denied dialog:", error);
  }
}

main();