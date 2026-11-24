import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./styles.css";
import "./styles2.css";
import "./theme.css";
import "./premium.css";
import "./tokens.css";
import "./dashboard.css";
import "./flat.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
