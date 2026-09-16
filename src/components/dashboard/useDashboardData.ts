import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getConversations, getLeads, getRepoVersion, subscribeRepo } from "@/data/leadRepo";
import { listQuotes, subscribeQuotes } from "@/data/quotes";
import { listCampaigns, type Campaign } from "@/lib/campaigns";
import { apiListContents, apiListSchedule } from "@/data/marketingRepo";
import type { MarketingContentRow, MarketingScheduleRow } from "@/lib/marketing/marketing.types";
import { useAuth } from "@/auth/AuthContext";
import { useCoachAlerts } from "@/hooks/useCoachAlerts";

export interface DashboardData {
  leads: ReturnType<typeof getLeads>;
  conversations: ReturnType<typeof getConversations>;
  quotes: ReturnType<typeof listQuotes>;
  campaigns: Campaign[];
  contents: MarketingContentRow[];
  schedule: MarketingScheduleRow[];
  attentionCount: number;
  loadingGrowth: boolean;
}

export function useDashboardData(): DashboardData {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  useSyncExternalStore(subscribeRepo, getRepoVersion, getRepoVersion);
  const quotes = useSyncExternalStore(subscribeQuotes, listQuotes, listQuotes);
  const { totalConversations: coachAttention } = useCoachAlerts();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [contents, setContents] = useState<MarketingContentRow[]>([]);
  const [schedule, setSchedule] = useState<MarketingScheduleRow[]>([]);
  const [loadingGrowth, setLoadingGrowth] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setLoadingGrowth(true);
    void Promise.all([
      listCampaigns(companyId).catch(() => []),
      apiListContents().catch(() => []),
      apiListSchedule().catch(() => []),
    ]).then(([nextCampaigns, nextContents, nextSchedule]) => {
      if (cancelled) return;
      setCampaigns(nextCampaigns);
      setContents(nextContents);
      setSchedule(nextSchedule);
      setLoadingGrowth(false);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const leads = getLeads();
  const conversations = getConversations();
  const attentionCount = useMemo(() => {
    const waitingHuman = conversations.filter((item) => item.aiStatus === "aguardando_humano").length;
    const unanswered = conversations.filter((item) => item.awaitingReply).length;
    const campaignIssues = campaigns.filter((item) => item.meta_delivery_status === "issues_on_meta" || item.meta_sync_status === "failed").length;
    const failedPosts = schedule.filter((item) => item.status === "failed").length;
    return waitingHuman + unanswered + coachAttention + campaignIssues + failedPosts;
  }, [campaigns, coachAttention, conversations, schedule]);

  return { leads, conversations, quotes, campaigns, contents, schedule, attentionCount, loadingGrowth };
}