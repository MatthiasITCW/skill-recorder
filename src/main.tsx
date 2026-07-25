import React from "react";
import { createRoot } from "react-dom/client";

import { Library } from "./Library";
import { Recorder } from "./Recorder";
import "./App.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

const isLibrary = window.location.hash.replace("#", "") === "library";
document.body.dataset.route = isLibrary ? "library" : "recorder";

createRoot(root).render(
  <React.StrictMode>{isLibrary ? <Library /> : <Recorder />}</React.StrictMode>,
);
