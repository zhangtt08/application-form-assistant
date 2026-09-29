import { useCallback, useEffect, useMemo, useState } from "react";
import type { Profile } from "../../types/profile";
import type { ProfileType } from "../../job/profileTypes";
import {
  activeLibrary as pickActiveLibrary,
  addLibrary,
  getStoreLoadProblem,
  loadStore,
  profileForLibrary,
  removeLibrary,
  saveStore,
  setActiveLibraryId,
  subscribeStoreChanges,
  updateLibraryMeta,
  type ProfileLibrary,
  type ProfileStore,
} from "../../profile/libraryStore";
import { saveProfile } from "../../profile/profileStore";

export interface UseProfileResult {
  /** 当前资料库对应的完整 Profile（管线与编辑器都用这一份） */
  profile: Profile | null;
  /** 仅更新内存中的 draft（不落盘） */
  update: (next: Profile) => void;
  /** 落盘：公共信息写 shared，其余写当前库 */
  persist: (next: Profile) => Promise<void>;
  store: ProfileStore | null;
  /** 资料库读取异常（数据损坏并已备份）；正常时为 null */
  loadProblem: string | null;
  libraries: ProfileLibrary[];
  activeLibrary: ProfileLibrary | null;
  activeLibraryId: string;
  switchLibrary: (id: string) => Promise<void>;
  createLibrary: (input: {
    name: string;
    directions: ProfileType[];
    copyCurrent?: boolean;
  }) => Promise<ProfileLibrary | null>;
  updateLibrary: (
    id: string,
    patch: Partial<Pick<ProfileLibrary, "name" | "directions" | "note">>,
  ) => Promise<void>;
  deleteLibrary: (id: string) => Promise<void>;
}

export function useProfile(): UseProfileResult {
  const [store, setStore] = useState<ProfileStore | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);

  const applyStore = useCallback((next: ProfileStore) => {
    setStore(next);
    setProfile(profileForLibrary(next, next.activeLibraryId));
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadStore().then((s) => {
      if (mounted) {
        applyStore(s);
        setLoadProblem(getStoreLoadProblem());
      }
    });
    const unsub = subscribeStoreChanges((s) => {
      if (mounted && s) applyStore(s);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, [applyStore]);

  const update = useCallback((next: Profile) => {
    setProfile(structuredClone(next));
  }, []);

  const persist = useCallback(async (next: Profile) => {
    await saveProfile(next);
    setProfile(structuredClone(next));
  }, []);

  const switchLibrary = useCallback(
    async (id: string) => {
      const fresh = await loadStore();
      const next = setActiveLibraryId(fresh, id);
      await saveStore(next);
      applyStore(next);
    },
    [applyStore],
  );

  const createLibrary = useCallback(
    async (input: { name: string; directions: ProfileType[]; copyCurrent?: boolean }) => {
      const fresh = await loadStore();
      const added = addLibrary(fresh, {
        name: input.name,
        directions: input.directions,
        copyFromLibraryId: input.copyCurrent ? fresh.activeLibraryId : undefined,
      });
      await saveStore(added.store);
      applyStore(added.store);
      return added.library;
    },
    [applyStore],
  );

  const updateLibrary = useCallback(
    async (id: string, patch: Partial<Pick<ProfileLibrary, "name" | "directions" | "note">>) => {
      const fresh = await loadStore();
      const next = updateLibraryMeta(fresh, id, patch);
      await saveStore(next);
      applyStore(next);
    },
    [applyStore],
  );

  const deleteLibrary = useCallback(
    async (id: string) => {
      const fresh = await loadStore();
      const next = removeLibrary(fresh, id);
      if (next === fresh) return; // 只剩一个库，不允许删
      await saveStore(next);
      applyStore(next);
    },
    [applyStore],
  );

  const libraries = useMemo(() => store?.libraries ?? [], [store]);
  const active = useMemo(() => (store ? pickActiveLibrary(store) : null), [store]);

  return {
    profile,
    update,
    persist,
    store,
    loadProblem,
    libraries,
    activeLibrary: active,
    activeLibraryId: store?.activeLibraryId ?? "",
    switchLibrary,
    createLibrary,
    updateLibrary,
    deleteLibrary,
  };
}
