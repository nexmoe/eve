import ReactDOM from "react-dom/client";
import { App } from "./app";
import "./styles.css";

document.body.dataset.platform = navigator.userAgent.toLowerCase().includes("windows")
  ? "win32"
  : "other";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
