import { Connector } from "./connector";
import { LocalFsConnector } from "./connectors/localfs";
import { GDriveConnector } from "./connectors/gdrive";
import { driveFor } from "./google";
import { WorkspaceRow } from "./db";
import { IgnoringConnector } from "./ignore";

// Every tool reaches a workspace through this, so the workspace's own
// `ignore:` list (in _Workspace.yaml) applies everywhere.
export function connectorFor(ws: WorkspaceRow): Connector {
  return new IgnoringConnector(rawConnectorFor(ws));
}

function rawConnectorFor(ws: WorkspaceRow): Connector {
  if (ws.kind === "local") return new LocalFsConnector(ws.root);
  if (!ws.account_email) throw new Error("Drive workspace has no connected account");
  return new GDriveConnector(driveFor(ws.account_email), ws.root);
}
