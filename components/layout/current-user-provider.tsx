"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getSessionRoleAction } from "@/lib/actions/auth-actions";

/**
 * 現在ユーザーの権限を Client Component へ配送するコンテキスト (#155)。
 *
 * PPR 安全性: 本 Provider は Client Component であり、RSC の `children` を prop 経由で
 * 通過させる (ThemeProvider 同型)。ロール取得は hydration 後の `useEffect` から
 * Server Action を 1 回呼ぶだけで、(main) ページ本体の静的シェル prerender に
 * cookies() を持ち込まない。`app/(main)/layout.tsx` は segment 内ナビゲーションで
 * 再 mount しないため、fetch はセッション/フルロード毎に 1 回で済む。
 *
 * `isAdmin` は破壊的操作ボタンの無効化に使う UX 補助であり、認可の真の防御は
 * 各 Server Action の requireAdmin ガード。`loaded` が false の間はボタンを
 * 無効化しない (`disabled = loaded && !isAdmin`) ことで admin のちらつきを避ける。
 */
export interface CurrentUserContextValue {
  /** 現在ユーザーが admin ロールか。ロール取得前は false。 */
  isAdmin: boolean;
  /** ロール取得が完了したか。false の間は権限不明。 */
  loaded: boolean;
}

const CurrentUserContext = createContext<CurrentUserContextValue>({
  isAdmin: false,
  loaded: false,
});

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CurrentUserContextValue>({
    isAdmin: false,
    loaded: false,
  });

  useEffect(() => {
    let active = true;
    getSessionRoleAction().then((result) => {
      if (!active) return;
      setState({
        isAdmin: result.ok ? result.data.isAdmin : false,
        loaded: true,
      });
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <CurrentUserContext.Provider value={state}>
      {children}
    </CurrentUserContext.Provider>
  );
}

/** 破壊的操作ボタンの無効化判定に使う。`disabled = loaded && !isAdmin`。 */
export function useIsAdmin(): CurrentUserContextValue {
  return useContext(CurrentUserContext);
}
