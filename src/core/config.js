/* Extracted from index.html inline application script. Keep plain-script execution semantics. */
    const LOGO_SRC = "page-logo.png";
    const LOGO_FALLBACK_SRC = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 160"><rect width="480" height="160" fill="none"/><text x="50%" y="48%" dominant-baseline="middle" text-anchor="middle" fill="#eee9df" font-size="54" font-family="Arial, sans-serif" font-weight="900" letter-spacing="-2">GEEKS</text><text x="50%" y="74%" dominant-baseline="middle" text-anchor="middle" fill="#d84d89" font-size="18" font-family="Arial, sans-serif" font-weight="800">MINI4WD TOURNAMENT</text></svg>`);
    const LOGO_CANDIDATES = [
      "page-logo.png",
      "./page-logo.png",
      "/Tournament/page-logo.png",
      "https://chaserqq.github.io/Tournament/page-logo.png"
    ];

    function handleLogoError(img) {
      const currentIndex = Number(img.dataset.logoIndex || 0);
      const nextIndex = currentIndex + 1;
      if (nextIndex < LOGO_CANDIDATES.length) {
        img.dataset.logoIndex = String(nextIndex);
        img.src = LOGO_CANDIDATES[nextIndex];
        return;
      }
      img.onerror = null;
      img.src = LOGO_FALLBACK_SRC;
    }

    function logoMarkup(className) {
      return `<div class="${className} credit-mark"><span>made by GEEKS M.Y</span><small>Special Thanks to SOON.D</small></div>`;
    }
    const STORAGE_KEY = "mini4wdTournamentLiveState";
    const ROSTER_KEY = "mini4wdRosterDB";
    const RECENT_PARTICIPANTS_KEY = "mini4wdRecentParticipantIds";
    const PENDING_PARTICIPANTS_KEY = "mini4wdPendingParticipantsText";

    const DEFAULT_TOURNAMENT_ID = "open-class-20260522";
    const FIREBASE_CONFIG = {
      apiKey: "AIzaSyB6xeY68_H0CFR3en1d5ksUmet_nvQy8y0",
      authDomain: "geeks-46794.firebaseapp.com",
      databaseURL: "https://geeks-46794-default-rtdb.firebaseio.com",
      projectId: "geeks-46794",
      storageBucket: "geeks-46794.firebasestorage.app",
      messagingSenderId: "265761666359",
      appId: "1:265761666359:web:538d8e8ca142ad109ed6b2",
      measurementId: "G-94MJJRQZME"
    };

    const SAMPLE_TEXT = `김철수/A팀
박민수/B팀
이영희/C팀
최준호/D팀
강민재/A팀
정다은/B팀
한지우/C팀
오세훈/D팀
윤서준/A팀
문하린/B팀
배도윤/C팀
신유진/D팀
장현우/E팀
권민서/F팀
임지훈/E팀
홍서연/F팀
조태민/G팀
백나연/H팀
남기준/G팀
서아린/H팀`;
