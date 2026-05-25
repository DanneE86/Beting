import { describe, expect, it } from "vitest";

import {
  extractTransfermarktClubCandidates,
  pickBestTransfermarktClubId,
} from "@/lib/injuries.functions";

describe("injuries.functions", () => {
  it("plockar ut klubbkandidater fran Transfermarkt-sok", () => {
    const html = `
      <table>
        <tr>
          <td><a href="/arsenal-fc/startseite/verein/11" title="Arsenal FC">Arsenal FC</a></td>
        </tr>
        <tr>
          <td><a href="/arsenal-tula/startseite/verein/6601" title="Arsenal Tula">Arsenal Tula</a></td>
        </tr>
      </table>
    `;
    const candidates = extractTransfermarktClubCandidates(html);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ id: 11, name: "Arsenal FC" });
  });

  it("valjer basta klubbmatch for lagnamn", () => {
    const id = pickBestTransfermarktClubId("Arsenal", [
      { id: 6601, name: "Arsenal Tula", href: "/arsenal-tula/startseite/verein/6601" },
      { id: 11, name: "Arsenal FC", href: "/arsenal-fc/startseite/verein/11" },
    ]);
    expect(id).toBe(11);
  });
});
