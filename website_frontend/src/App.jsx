import { Routes, Route, useLocation, matchPath } from "react-router-dom";

import TrackingPage from "./pages/TrackingPage";
import StationPage from "./pages/StationPage";
import SystemPage from "./pages/SystemPage";
import Header from "./components/Header";
import Footer from "./components/Footer";
import Auth from "./pages/AuthV2";
import ProtectedRoute from "./components/ProtectedRoute";
import UserPage from "./pages/UserPage";
import HistoryPage from "./pages/HistoryPage";
import AdminPage from "./pages/AdminPage";
import PartsPage from "./pages/PartsPage";
import PhotoUploadPage from "./pages/PhotoUploadPage";

import ScrollToTop from "./helpers/ScrollToTop";

import "./styles/datepicker.css";
import { useEffect } from "react";
import ShippingPage from "./pages/ShippingPage";

function App() {
  const protectedPage = (page) => <ProtectedRoute>{page}</ProtectedRoute>;
  const LOCATION = import.meta.env.VITE_LOCATION;
  const location = useLocation();

  useEffect(() => {
    const baseTitle = `${LOCATION} Dashboard`;
    const pathname = location.pathname;

    let pageTitle = "";
    if (pathname === "/") pageTitle = "Tracking";
    else if (pathname === "/stations") pageTitle = "Stations";
    else if (pathname === "/shipping") pageTitle = "Shipping";
    else if (pathname === "/parts") pageTitle = "Parts";
    else if (pathname === "/admin") pageTitle = "Admin";
    else if (pathname === "/user") pageTitle = "User";
    else if (pathname === "/auth") pageTitle = "Login";
    else if (pathname === "/reset-password") pageTitle = "Reset Password";
    else if (matchPath("/locationHistory/:id", pathname)) pageTitle = "Location History";
    else if (matchPath("/photo-upload/:serviceTag", pathname)) pageTitle = "Photo Upload";
    else {
      const systemMatch = matchPath("/:serviceTag", pathname);
      if (systemMatch?.params?.serviceTag) {
        pageTitle = String(systemMatch.params.serviceTag).toUpperCase();
      }
    }

    document.title = pageTitle ? `${pageTitle} - ${baseTitle}` : baseTitle;
  }, [LOCATION, location.pathname]);

  useEffect(() => {
    if (location.pathname === "/auth") return;
    const fullPath = `${location.pathname}${location.search}${location.hash}`;
    sessionStorage.setItem("postLoginRedirect", fullPath);
  }, [location.pathname, location.search, location.hash]);

  return (
    <div className="flex min-h-dvh flex-col bg-gray-100 overflow-x-clip text-gray-800 font-roboto">
      {/* <ScrollToTop /> */}
      <Header />
      <div className="flow-root min-w-0 flex-1 pb-10">
        <Routes>
          <Route path="/" element={protectedPage(<TrackingPage />)} />
          <Route path="/stations" element={protectedPage(<StationPage />)} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/shipping" element={protectedPage(<ShippingPage />)} />
          <Route path="/:serviceTag" element={protectedPage(<SystemPage />)} />
          <Route path="/parts" element={protectedPage(<PartsPage />)} />
          <Route path="/photo-upload/:serviceTag" element={protectedPage(<PhotoUploadPage />)} />
          <Route
            path="/user"
            element={
              <ProtectedRoute>
                <UserPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminPage />
              </ProtectedRoute>
            }
          />
          <Route path="/locationHistory/:id" element={protectedPage(<HistoryPage />)} />
        </Routes>
      </div>
      <Footer className="mt-10 shrink-0" />
    </div>
  );
}

export default App;
