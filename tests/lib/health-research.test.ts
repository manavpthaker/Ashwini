import { describe, expect, it, vi } from "vitest";
import { fetchHealthResearch, topicsForCheckin } from "@/lib/health-research";

describe("public literature retrieval", () => {
  it("maps private wording to a bounded non-identifying topic vocabulary", async () => {
    const topics = topicsForCheckin(
      "My email is private@example.org; I slept badly before training in MyTown",
    );
    expect(topics).toEqual(["sleep", "training"]);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ resultList: { result: [] } })));
    await fetchHealthResearch(topics, new Date(), fetcher);
    for (const args of fetcher.mock.calls as unknown as Array<[URL]>) {
      expect(String(args[0])).not.toMatch(/private|MyTown|example/);
      expect(args[0].hostname).toBe("www.ebi.ac.uk");
    }
  });
  it("normalizes real article metadata, removes retracted results and deduplicates", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            resultList: {
              result: [
                {
                  id: "123",
                  title: "Review",
                  pubYear: "2020",
                  pubTypeList: { pubType: ["Review"] },
                  abstractText: "<p>Abstract.</p>",
                },
                {
                  id: "456",
                  title: "Retracted",
                  pubTypeList: { pubType: ["Retracted Publication"] },
                  abstractText: "Discard",
                },
                { id: "not-a-pmid", title: "Bad", abstractText: "No" },
              ],
            },
          }),
        ),
    );
    const result = await fetchHealthResearch(["sleep", "training"], new Date(), fetcher);
    expect(result.status).toBe("retrieved");
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]?.url).toBe("https://pubmed.ncbi.nlm.nih.gov/123/");
  });
  it("distinguishes unavailable evidence from no research requested", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 503 }));
    expect((await fetchHealthResearch([], new Date(), fetcher)).status).toBe("not_requested");
    expect(fetcher).not.toHaveBeenCalled();
    expect((await fetchHealthResearch(["sleep"], new Date(), fetcher)).status).toBe("unavailable");
  });
});
