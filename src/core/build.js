(function(){
  "use strict";

  const surfaces = [
    "operator",
    "admin-accounts",
    "admin-matches",
    "dashboard",
    "player-management",
    "mobile-live",
    "tv-live",
    "live-lobby",
    "login",
    "restricted",
    "print",
    "error"
  ];

  const pageClasses = [
    "ui-page-operator",
    "ui-page-db",
    "ui-page-admin",
    "ui-page-dashboard",
    "ui-page-live-lobby",
    "ui-page-mobile-live",
    "ui-page-tv-live",
    "ui-page-login",
    "ui-page-print",
    "ui-page-restricted",
    "ui-page-error"
  ];

  const rendererSurfaceHooks = [
    ["renderOperator", "operator"],
    ["renderDbPage", "player-management"],
    ["renderAdminPage", "admin-accounts"],
    ["renderAdminMatchDataPage", "admin-matches"],
    ["renderDashboardPage", "dashboard"],
    ["renderDashboardWithRecords", "dashboard"],
    ["renderDashboardErrorV55", "dashboard"],
    ["renderLiveLobbyPage", "live-lobby"],
    ["renderLiveLobbyWithData", "live-lobby"],
    ["renderMobileSnapshot", "mobile-live"],
    ["renderTvStage", "tv-live"],
    ["renderLoginPage", "login"],
    ["renderPendingPage", "restricted"],
    ["renderRestrictedPage", "restricted"],
    ["renderPrintView", "print"]
  ];

  const meta = Object.freeze({
    version: 283,
    label: "BUILD v283 LIVE LOBBY USABILITY",
    title: "MINI4WD TOURNAMENT MAKER - v283 LIVE LOBBY USABILITY",
    rulesChanged: false,
    assets: Object.freeze({
      config: 156,
      build: 283,
      app: 283,
      css: 283,
      operatorMobileCss: 283,
      og: 51
    }),
    surfaces: Object.freeze(surfaces),
    pageClasses: Object.freeze(pageClasses),
    rendererSurfaceHooks: Object.freeze(rendererSurfaceHooks)
  });

  window.MINI4WD_BUILD_META = meta;
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("data-build-version", String(meta.version));
    document.documentElement.setAttribute("data-build-label", meta.label);
  }
})();
