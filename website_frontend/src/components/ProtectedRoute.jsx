import { Navigate } from "react-router-dom";
import { useContext } from "react";
import { AuthContext } from "../context/AuthContext";

export default function ProtectedRoute({ children }) {
  const { token, initializing } = useContext(AuthContext);

  if (initializing) return <div className="p-8 text-center">Loading session…</div>;

  if (!token) {
    return <Navigate to="/auth" replace />;
  }

  return children;
}
