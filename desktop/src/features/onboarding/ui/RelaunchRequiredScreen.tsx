import { RecoveryScreen } from "./RecoveryScreen";

export function RelaunchRequiredScreen() {
  return (
    <RecoveryScreen
      testId="relaunch-required"
      title="Restart MAC Workspace to finish recovery"
      body="Your identity was updated. MAC Workspace needs to restart so syncing and agents run under it."
    />
  );
}
