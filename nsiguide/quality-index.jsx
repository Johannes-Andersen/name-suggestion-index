import { createRoot } from "react-dom/client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSun, faMoon, faChartLine } from "@fortawesome/free-solid-svg-icons";
import { faGithub } from "@fortawesome/free-brands-svg-icons";

import { Quality } from "./Quality";

const setDarkMode = (val) => {
  const el = document.getElementById("root");
  if (!el) return;
  if (val === "true") el.classList.add("dark");
  else el.classList.remove("dark");
};

const DarkMode = () => {
  let currValue = window.localStorage.getItem("nsi-darkmode");
  if (currValue === null) {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      currValue = "true";
      window.localStorage.setItem("nsi-darkmode", currValue);
    }
  }
  setDarkMode(currValue);
  const checkedProp = currValue === "true" ? { defaultChecked: true } : {};

  const toggle = () => {
    const newValue =
      window.localStorage.getItem("nsi-darkmode") === "true" ? "false" : "true";
    window.localStorage.setItem("nsi-darkmode", newValue);
    setDarkMode(newValue);
  };

  return (
    <div id="darkmode" className="control">
      <FontAwesomeIcon icon={faSun} size="lg" />
      <label className="switch">
        <input
          id="nsi-darkmode"
          type="checkbox"
          {...checkedProp}
          onChange={toggle}
        />
        <span className="slider round"></span>
      </label>
      <FontAwesomeIcon icon={faMoon} size="lg" />
    </div>
  );
};

const Header = () => (
  <div id="header" className="hasCols">
    <div id="title">
      <h1>
        <FontAwesomeIcon
          icon={faChartLine}
          className="hi"
          style={{ color: "#4caf82" }}
        />
        Data Quality
      </h1>
    </div>
    <div id="nav">
      <a href="index.html">← Back to nsi.guide</a>
    </div>
    <DarkMode />
    <div id="octocat">
      <a
        href="https://github.com/osmlab/name-suggestion-index"
        target="_blank"
        rel="noreferrer"
      >
        <FontAwesomeIcon icon={faGithub} size="2x" />
      </a>
    </div>
  </div>
);

const App = () => (
  <>
    <Header />
    <Quality />
    <div id="footer">
      See the{" "}
      <a href="https://github.com/osmlab/name-suggestion-index">
        NSI GitHub project
      </a>{" "}
      for contribution details.
    </div>
  </>
);

const root = createRoot(document.getElementById("root"));
root.render(<App />);
