import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import DevelopmentNotice from "./DevelopmentNotice";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DevelopmentNotice />
    <App />
  </React.StrictMode>,
);
