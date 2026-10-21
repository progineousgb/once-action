export function settle(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
