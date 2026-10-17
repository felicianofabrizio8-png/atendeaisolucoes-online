// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ user: null, company: null }) }));
vi.mock("@/hooks/useTeamAccess", () => ({ useTeamAccess: () => ({ access: undefined }) }));
vi.mock("@/lib/goals/useGoals", () => ({
  useGoals: () => ({
    companyId: null,
    ready: null,
    agendaReady: false,
    loading: true,
    error: null,
    goals: [],
    progress: new Map(),
    stages: [],
    insights: [],
    members: [],
    reload: vi.fn(),
    actions: {},
  }),
}));

import { GoalsPage } from "../GoalsDashboard";

afterEach(cleanup);

describe("página de metas sem empresa", () => {
  it("explica que precisa entrar, em vez de carregar para sempre", () => {
    render(<GoalsPage />);
    expect(screen.queryByText("Carregando metas…")).toBeNull();
    expect(screen.getByText("Entre na sua conta para ver as metas da equipe.")).toBeInTheDocument();
  });
});
