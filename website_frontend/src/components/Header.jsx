import { useState, useContext, useEffect, useRef } from "react";
import { AuthContext } from "../context/AuthContext";
import { Link, useLocation } from "react-router-dom";
import useApi from "../hooks/useApi";
import SmartSearchBar from "../components/SmartSearchBar.jsx";

function Header() {
  const LOCATION = import.meta.env.VITE_LOCATION;
  const BACKEND_URL = import.meta.env.VITE_DEV_BACKEND_TARGET || import.meta.env.VITE_BACKEND_URL;

  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchHidden, setSearchHidden] = useState(false);
  const [searchPinned, setSearchPinned] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const searchRowRef = useRef(null);
  const lastScrollYRef = useRef(0);
  const scrollDeltaRef = useRef(0);
  const ignoreLayoutScrollUntilRef = useRef(0);

  const { token } = useContext(AuthContext);

  const linkBase =
    "rounded-lg px-3 py-2 text-sm font-medium text-blue-100 transition-colors hover:bg-white/10 hover:text-white";
  const active = "bg-white/15 text-white";

  const [user, setUser] = useState(null);
  const [repairsAllowed, setRepairsAllowed] = useState(null);
  const { getMe, getRepairsAllowed } = useApi();

  useEffect(() => {
    setSearchHidden(false);
    setSearchPinned(false);
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    // Changing the sticky header height can move the document's scroll position.
    // Ignore that movement when deciding whether the user scrolled down.
    ignoreLayoutScrollUntilRef.current = Date.now() + 250;
  }, [searchHidden]);

  useEffect(() => {
    if (!token) return;
    lastScrollYRef.current = window.scrollY;
    const onScroll = () => {
      const nextY = Math.max(0, window.scrollY);
      const change = nextY - lastScrollYRef.current;
      lastScrollYRef.current = nextY;
      if (nextY <= 8) {
        scrollDeltaRef.current = 0;
        setSearchPinned(false);
        setSearchHidden(false);
        return;
      }
      if (Date.now() < ignoreLayoutScrollUntilRef.current) {
        scrollDeltaRef.current = 0;
        return;
      }
      if (change <= 0) {
        scrollDeltaRef.current = 0;
        return;
      }
      scrollDeltaRef.current += change;
      if (nextY < 80 || scrollDeltaRef.current < 12) return;
      scrollDeltaRef.current = 0;
      if (!searchPinned && !searchRowRef.current?.contains(document.activeElement)) {
        setSearchHidden(true);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [token, searchPinned]);

  function toggleSearch() {
    if (searchHidden) {
      setSearchHidden(false);
      setSearchPinned(true);
      setSearchFocusToken((value) => value + 1);
    } else {
      setSearchHidden(true);
      setSearchPinned(false);
    }
  }

  useEffect(() => {
    if (!token) { setUser(null); return; }
    let isMounted = true;
    (async () => {
      try {
        const data = await getMe(); // still uses getMe, just not in deps
        if (!isMounted) return;
        setUser(data?.user ?? null);
      } catch (e) {
        console.error("getUser failed:", e);
        if (isMounted) setUser(null);
      }
    })();
    return () => {
      isMounted = false;
    };
    // We only care about token changes here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Request protected settings only after authentication.
  useEffect(() => {
    if (!token) { setRepairsAllowed(null); return; }
    let isMounted = true;
    (async () => {
      try {
        const data = await getRepairsAllowed();
        if (!isMounted) return;
        setRepairsAllowed(
          typeof data?.repairs_allowed === "boolean"
            ? data.repairs_allowed
            : null,
        );
      } catch (e) {
        console.error("getRepairsAllowed failed:", e);
        if (isMounted) setRepairsAllowed(null);
      }
    })();
    return () => {
      isMounted = false;
    };
    // Recheck the setting when the authenticated session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <header id="site-header" className="sticky top-0 z-40 border-b border-blue-950/50 bg-blue-900 px-4 py-2 text-white shadow-sm">
      <div className="flex items-center justify-between h-[60px]">
        {/* Left: logo + title */}
        <div className="flex items-center gap-2">
          <img
            src="/wistron_logo.svg"
            alt="Wistron Labs"
            className="h-[25px] md:h-[30px]"
          />
          <h1 className="text-lg font-semibold tracking-tight md:text-xl">
            {LOCATION} Dashboard{" "}
            {import.meta.env.DEV && (
              <span className="ml-1 rounded bg-red-400/20 px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-wide text-red-200"
                title={`Backend: ${BACKEND_URL}`}>
                DEV
              </span>
            )}
          </h1>
        </div>

        {/* Right: desktop nav and search */}
        {token && <div className="flex items-center gap-1">
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main navigation">
          <Link
            to="/"
            className={`${linkBase} ${pathname === "/" ? active : ""}`}
          >
            Home
          </Link>
          <Link
            to="/stations"
            className={`${linkBase} ${pathname === "/stations" ? active : ""}`}
          >
            Stations
          </Link>
          <Link
            to="/shipping"
            className={`${linkBase} ${pathname === "/shipping" ? active : ""}`}
          >
            Shipping
          </Link>
          {repairsAllowed !== false && (
            <Link
              to="/parts"
              className={`${linkBase} ${pathname === "/parts" ? active : ""}`}
            >
              Parts
            </Link>
          )}
          <Link
            to="/user"
            className={`${linkBase} ${pathname === "/user" ? active : ""}`}
          >
            Account
          </Link>
          {user?.isAdmin && (
            <Link
              to="/admin"
              className={`${linkBase} ${pathname === "/admin" ? active : ""}`}
            >
              Admin
            </Link>
          )}
          {!user?.isAdmin && (
            <a
              href="https://github.com/giovannirleon/wistronlabs"
              target="_blank"
              rel="noopener noreferrer"
              className={linkBase}
              onClick={() => setMenuOpen(false)}
            >
              Need help?
            </a>
          )}
          </nav>
          <button type="button" onClick={toggleSearch} aria-label={searchHidden ? "Open search" : "Hide search"}
            aria-expanded={!searchHidden} aria-controls="site-search-row"
            className={`inline-flex items-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors ${searchHidden ? "px-3" : "px-2"} ${searchHidden
              ? "text-blue-100 hover:bg-white/10 hover:text-white"
              : "bg-white/15 text-white hover:bg-white/20"}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="m20 20-4-4" />
            </svg>
            {searchHidden && <span className="hidden lg:inline">Search</span>}
          </button>
          <button type="button" onClick={() => setMenuOpen((prev) => !prev)}
            aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen}
            className="rounded-lg p-2 text-white hover:bg-white/10 lg:hidden">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
              <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>}

        {/* Mobile menu overlay */}
        {token && menuOpen && (
          <div className="absolute top-full left-0 w-full bg-blue-900 flex flex-col gap-2 px-4 py-3 shadow-md lg:hidden">
            <Link
              to="/"
              className={`${linkBase} ${pathname === "/" ? active : ""}`}
              onClick={() => setMenuOpen(false)}
            >
              Home
            </Link>
            <Link
              to="/stations"
              className={`${linkBase} ${
                pathname === "/stations" ? active : ""
              }`}
              onClick={() => setMenuOpen(false)}
            >
              Stations
            </Link>
            <Link
              to="/shipping"
              className={`${linkBase} ${
                pathname === "/shipping" ? active : ""
              }`}
              onClick={() => setMenuOpen(false)}
            >
              Shipping
            </Link>
            {repairsAllowed !== false && (
              <Link
                to="/parts"
                className={`${linkBase} ${pathname === "/parts" ? active : ""}`}
                onClick={() => setMenuOpen(false)}
              >
                Parts
              </Link>
            )}
            <Link
              to="/user"
              className={`${linkBase} ${pathname === "/user" ? active : ""}`}
              onClick={() => setMenuOpen(false)}
            >
              Account
            </Link>
            {user?.isAdmin && (
              <Link
                to="/admin"
                className={`${linkBase} ${pathname === "/admin" ? active : ""}`}
                onClick={() => setMenuOpen(false)}
              >
                Admin
              </Link>
            )}
            {!user?.isAdmin && (
              <a
                href="https://github.com/giovannirleon/wistronlabs"
                target="_blank"
                rel="noopener noreferrer"
                className={linkBase}
                onClick={() => setMenuOpen(false)}
              >
                Need help?
              </a>
            )}
          </div>
        )}
      </div>
      {token && <div id="site-search-row" ref={searchRowRef}
        inert={searchHidden} aria-hidden={searchHidden}
        className={`relative transition-[max-height,opacity,padding] duration-200 ease-out ${searchHidden
          ? "pointer-events-none max-h-0 overflow-hidden pb-0 opacity-0"
          : "max-h-20 overflow-visible pb-2 pt-2 opacity-100"}`}>
        <div className="mx-auto max-w-4xl">
          <SmartSearchBar focusToken={searchFocusToken} />
        </div>
      </div>}
    </header>
  );
}

export default Header;
