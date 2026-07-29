import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/_app/returns")({
  component: ReturnsRedirect,
});

function ReturnsRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate({ to: "/sales-returns", replace: true });
  }, [navigate]);

  return null;
}
