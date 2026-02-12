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

// Catch synchronous uncaught errors (e.g. thrown in event handlers outside Vue)
window.addEventListener("error", (event) => {
  console.error("[Uncaught Error]", event.error ?? event.message);
});

app.mount("#app");
