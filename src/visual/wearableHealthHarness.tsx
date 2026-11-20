import { createRoot } from "react-dom/client";
import "../index.css";
import { ThemeProvider } from "../contexts/ThemeContext";
import { LearningInsightsTab } from "../components/tabs/LearningInsightsTab";
import { healthConnectFixture, learningReportFixture, sleepChartFixture } from "../components/health/__tests__/healthFixtures";

const options = new URLSearchParams(window.location.search);
const theme = options.get("theme") === "dark" ? "obsidian-noir" : "aurora-light";

let healthRecorded = false;
let demo = false;
let connected = false;
let notes: string | null = null;

if (!options.has("web")) {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: {
      async invoke(command: string, args?: Record<string, unknown>) {
        switch (command) {
          case "health_load_demo_dataset": demo = true; return;
          case "health_clear_demo_dataset": demo = false; return;
          case "health_upsert_manual_sleep": {
            const input = args?.input as { notes?: string };
            notes = input.notes ?? null;
            healthRecorded = true;
            return;
          }
          case "health_get_manual_sleep": return { notes, subjectiveQuality: 4 };
          case "health_get_sleep_chart_data": return sleepChartFixture(healthRecorded || demo, demo);
          case "health_get_learning_insights": return learningReportFixture();
          case "health_get_study_plan_insights": return learningReportFixture(String(args?.planId));
          case "health_list_providers": return [{
            ...healthConnectFixture,
            readinessState: connected ? "connected" : "requires_user_authorization",
            readinessReason: connected ? "Connected to Health Connect." : "Available on this device.",
          }, {
            ...healthConnectFixture, id: "oura", category: "cloud_oauth", displayName: "Oura",
            readinessState: "temporarily_unavailable", readinessReason: "The sign-in service is offline.",
          }];
          case "health_get_connections": return connected ? [{
            providerId: "android_health_connect", authState: "authorized", status: "connected", historyLimitDays: 30,
          }] : [];
          case "health_get_consent_log":
          case "health_get_source_preferences": return [];
          case "health_connect_native":
            if (options.has("denied")) throw new Error("Health Connect permission was denied.");
            connected = true;
            return { sleepUpserts: 1, warnings: [] };
          case "health_disconnect_provider": connected = false; return;
          case "health_wipe_all_data": connected = false; healthRecorded = false; notes = null; return;
          default: return null;
        }
      },
      transformCallback: () => 1,
    },
  });
}

createRoot(document.getElementById("root")!).render(<ThemeProvider defaultTheme={theme}><LearningInsightsTab /></ThemeProvider>);
