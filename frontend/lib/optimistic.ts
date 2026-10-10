/** Show a reversible local change now, then reconcile or restore it. Never retry writes. */
export async function optimisticUpdate<T>(options: {
  apply: () => void;
  persist: () => Promise<T>;
  reconcile: (saved: T) => void;
  rollback: () => void;
}): Promise<void> {
  options.apply();
  try {
    const saved = await options.persist();
    options.reconcile(saved);
  } catch (error) {
    options.rollback();
    throw error;
  }
}
