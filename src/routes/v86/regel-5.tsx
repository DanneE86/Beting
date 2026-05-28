import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/v86/regel-5")({
  beforeLoad: () => {
    throw redirect({ to: "/v86" });
  },
});
