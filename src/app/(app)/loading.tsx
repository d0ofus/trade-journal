function LoadingCard() {
  return <div className="h-32 animate-pulse rounded-xl border border-slate-200 bg-white" />;
}

export default function AppLoading() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-72 animate-pulse rounded bg-slate-200" />
      </div>

      <div className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <LoadingCard />
        <LoadingCard />
        <LoadingCard />
        <LoadingCard />
        <LoadingCard />
        <LoadingCard />
      </div>
    </div>
  );
}
