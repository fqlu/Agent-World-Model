// Where the app is running. Cloud Run sets K_SERVICE; HUB_HOSTED=1 forces it.
// When hosted, workspaces must be Google Drive folders — the server's own disk
// is not the user's machine, so local-folder workspaces and the local folder
// browser are turned off.
export function isHosted(): boolean {
  return Boolean(process.env.K_SERVICE) || process.env.HUB_HOSTED === "1";
}
