const fs = require("fs");
const { readFile, writeFile } = require("fs/promises");
const path = require("path");
const dotenv = require("dotenv");
const moment = require("moment-timezone");
const os = require("os");

const userPluginDir = path.join(os.homedir(), ".n8n-desktop-plugins");
console.log("userPluginDir =>", userPluginDir);
const defaultEnv = `
N8N_DEPLOYMENT_TYPE='${getDeploymentType()}'
EXECUTIONS_PROCESS='main'
EXECUTIONS_DATA_SAVE_ON_PROGRESS=true
EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS=true
N8N_BASIC_AUTH_ACTIVE=true
N8N_BASIC_AUTH_USER='${generateRandomString()}'
N8N_BASIC_AUTH_PASSWORD='${generateRandomString()}'
N8N_PORT=5678
N8N_ALLOW_LOADING_CUSTOM_NODES=true
N8N_COMMUNITY_PACKAGES_ENABLED=true
N8N_CUSTOM_EXTENSIONS=${userPluginDir}
`;

// from packages/cli/commands/start.ts
function generateRandomString() {
  const availableCharacters = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 24 })
    .map(() => {
      return availableCharacters.charAt(
        Math.floor(Math.random() * availableCharacters.length)
      );
    })
    .join("");
}

function getDeploymentType() {
  if (process.platform === "darwin") return "desktop_mac";
  if (process.platform === "win32") return "desktop_win";
  throw new Error("Unsupported platform");
}

async function setEnvVars() {
  const dotN8nDir = await getDotN8nDir();

  await handleLoggingEnvVars(dotN8nDir);

  const desktopEnvPath = await getDesktopEnvPath(dotN8nDir);

  await addGenericTimezoneEnvVar(desktopEnvPath);

  dotenv.config({ path: desktopEnvPath });

  // LMS Integration environment variables
  if (!process.env.LMS_BEARER_TOKEN) {
    process.env.LMS_BEARER_TOKEN =
      "9040e52c42917e691e32afadeb36fa3b8b77c7519e9749215ff672c9d94c2eadc21d95e5d8929bdde12f1412056a5fdf63e6b10953480f896cbe9884be2b46029c0610b04557e796a1d942c9460544c92048f5ac6d006b8eff0efc3f005fb966847c0861156424801ec1ad4496708d12080aceb83865c2a33504cc0c6092df4125f4ae43944c5980ae2195f869dd31129a34b4d7b16a0dd0611668fcbe85ca021705083b395658b48b70812ad1";
  }

  if (!process.env.LMS_API_URL) {
    process.env.LMS_API_URL =
      "http://lms-dev.service.aide-0091473.ap.ctc.development.mesh.uhg.com/api/lms-ssoLogin";
  }
}

async function getDotN8nDir() {
  const dotN8nDir = path.join(getUserHome(), ".n8n");

  if (!fs.existsSync(dotN8nDir)) {
    await fs.promises.mkdir(dotN8nDir);
  }

  return dotN8nDir;
}

// from packages/core/src/UserSettings.ts
function getUserHome() {
  let variableName = "HOME";
  if (process.platform === "win32") {
    variableName = "USERPROFILE";
  }

  if (process.env[variableName] === undefined) {
    // If for some reason the variable does not exist
    // fall back to current folder
    return process.cwd();
  }

  return process.env[variableName];
}

async function getDesktopEnvPath(dotN8nDir) {
  const desktopEnvPath = path.join(dotN8nDir, "n8n-desktop.env");
  console.log(desktopEnvPath);
  if (!fs.existsSync(desktopEnvPath)) {
    await fs.promises.writeFile(desktopEnvPath, defaultEnv);
  }

  return desktopEnvPath;
}

async function addGenericTimezoneEnvVar(desktopEnvPath) {
  const envFileContent = await readFile(desktopEnvPath, "utf8");

  const containsGenericTimezoneEnvVar = envFileContent
    .split("\n")
    .some((line) => line.startsWith("GENERIC_TIMEZONE="));

  if (containsGenericTimezoneEnvVar) return;

  await writeFile(
    desktopEnvPath,
    [envFileContent, `GENERIC_TIMEZONE='${moment.tz.guess()}'`].join("\n")
  );
}

async function handleLoggingEnvVars(dotN8nDir) {
  if (
    process.env.N8N_LOG_OUTPUT === "file" &&
    process.env.N8N_LOG_FILE_LOCATION
  ) {
    const logsDirPath = path.join(dotN8nDir, "n8n-desktop-logs");

    if (!fs.existsSync(logsDirPath)) {
      await fs.promises.mkdir(logsDirPath);
    }

    process.env.N8N_LOG_FILE_LOCATION = path.join(
      logsDirPath,
      process.env.N8N_LOG_FILE_LOCATION
    );
  }
}

module.exports = { defaultEnv: defaultEnv.trim(), setEnvVars };