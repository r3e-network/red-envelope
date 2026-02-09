import { createApp } from "vue";
import App from "./App.vue";
import "./styles/main.scss";

const app = createApp(App);

// Global Vue error handler — catches render/lifecycle/watcher errors
app.config.errorHandler = (err, _instance, info) => {
  console.error(`[Vue Error] ${info}:`, err);
};

// Catch unhandled promise rejections (e.g. failed RPC, wallet errors)
window.addEventListener("unhandledrejection", (event) => {
  console.error("[Unhandled Rejection]", event.reason);
});

app.mount("#app");
