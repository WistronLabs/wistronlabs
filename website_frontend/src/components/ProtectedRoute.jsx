import { Navigate, useLocation } from "react-router-dom";
import { useContext } from "react";
import { AuthContext } from "../context/AuthContext";

export default function ProtectedRoute({ children }) {
  const { token, initializing } = useContext(AuthContext);
  const location = useLocation();

  if (initializing) return <div className="p-8 text-center">Loading session…</div>;

  if (!token) {
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }

  return children;
}
