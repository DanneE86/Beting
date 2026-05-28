import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/v86/regel-2")({
  beforeLoad: () => {
    throw redirect({ to: "/v86" });
  },
});
