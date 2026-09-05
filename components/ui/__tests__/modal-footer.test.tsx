import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ModalFooter } from "../modal";
import { MODAL_FOOTER_CLASS } from "../modal-classes";

/**
 * `ModalFooter` が実際に描画するクラスを検査する (#225 Phase 1)。
 *
 * `ModalContent` は `typeof document === "undefined"` で早期 return するため
 * node 環境では描画できないが、`ModalFooter` はポータルを使わないので
 * `renderToStaticMarkup` で最後まで到達できる。
 */
describe("ModalFooter の描画", () => {
  it("sticky なフッタのクラスを載せる", () => {
    const html = renderToStaticMarkup(<ModalFooter>確定</ModalFooter>);
    expect(html).toContain(MODAL_FOOTER_CLASS);
    expect(html).toContain("確定");
  });

  it("className prop を後ろに連結する", () => {
    // cn は素の clsx (tailwind-merge なし) なので、呼び出し側の指定は
    // 「後ろに並ぶ」だけ。同じプロパティを重ねると CSS の記述順で勝敗が決まる。
    const html = renderToStaticMarkup(
      <ModalFooter className="justify-between">確定</ModalFooter>,
    );
    expect(html).toContain(`${MODAL_FOOTER_CLASS} justify-between`);
  });
});
