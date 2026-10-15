import { describe, expect, it } from "vitest";
import { sequenceToStore, validateStoredSequence } from "../campaign-image-sequence";

type Media = { id: string; company_id: string };
type Store = { contents: { company_id: string; ai_prompt: Record<string, unknown> }[]; jobs: { company_id: string; image_sequence: unknown }[] };

const COMPANY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEDIA_A = "11111111-1111-4111-8111-111111111111";
const MEDIA_B = "22222222-2222-4222-8222-222222222222";
const focalA = { x: 0.2, y: 0.8, zoom: 1.4 };
const focalB = { x: 0.7, y: 0.3, zoom: 1.8 };

function createMockCampaign(store: Store, companyId: string, media: Media[]) {
  const sequence = sequenceToStore(media.map((item, position) => ({
    position,
    primary: position === 0,
    source: "marketing_media" as const,
    image_id: item.id,
    focal_point: position === 0 ? focalA : focalB,
  })));
  store.contents.push({ company_id: companyId, ai_prompt: { image_sequence: sequence } });
}

function approveMock(store: Store, companyId: string, edited: ReturnType<typeof sequenceToStore>, media: Media[]) {
  const sequence = validateStoredSequence(edited);
  for (const item of sequence) {
    const source = media.find((candidate) => candidate.id === item.image_id);
    if (!source || source.company_id !== companyId) throw new Error("image_cross_tenant");
  }
  const content = store.contents.find((row) => row.company_id === companyId);
  if (!content) throw new Error("campaign_not_found");
  content.ai_prompt = { ...content.ai_prompt, image_sequence: sequence };
  const job = { company_id: companyId, image_sequence: sequence };
  store.jobs.push(job);
  return job;
}

function claimMock(job: { company_id: string; image_sequence: unknown }, companyId: string) {
  if (job.company_id !== companyId) return null;
  return validateStoredSequence(job.image_sequence).sort((a, b) => a.position - b.position);
}

describe("integração mock: criação → aprovação → job → claim", () => {
  it("preserva ordem, focal points e tenant durante todo o caminho", () => {
    const store: Store = { contents: [], jobs: [] };
    const media = [{ id: MEDIA_A, company_id: COMPANY_A }, { id: MEDIA_B, company_id: COMPANY_A }];
    createMockCampaign(store, COMPANY_A, media);
    const edited = sequenceToStore([
      { position: 0, primary: true, source: "marketing_media", image_id: MEDIA_A, focal_point: focalB },
      { position: 1, primary: false, source: "marketing_media", image_id: MEDIA_B, focal_point: focalA },
    ]);
    const job = approveMock(store, COMPANY_A, edited, media);
    const claimed = claimMock(job, COMPANY_A);
    expect(store.contents[0].ai_prompt.image_sequence).toEqual(edited);
    expect(claimed?.map((item) => [item.position, item.image_id, item.focal_point])).toEqual([
      [0, MEDIA_A, focalB],
      [1, MEDIA_B, focalA],
    ]);
  });

  it("rejeita alteração cross-tenant antes de criar job", () => {
    const store: Store = { contents: [], jobs: [] };
    const media = [{ id: MEDIA_A, company_id: COMPANY_A }, { id: MEDIA_B, company_id: COMPANY_B }];
    createMockCampaign(store, COMPANY_A, [media[0]]);
    const edited = sequenceToStore([
      { position: 0, primary: true, source: "marketing_media", image_id: MEDIA_B, focal_point: focalA },
    ]);
    expect(() => approveMock(store, COMPANY_A, edited, media)).toThrow("image_cross_tenant");
    expect(store.jobs).toHaveLength(0);
    expect(claimMock({ company_id: COMPANY_A, image_sequence: edited }, COMPANY_B)).toBeNull();
  });
});