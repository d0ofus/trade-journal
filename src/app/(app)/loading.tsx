function LoadingCard() {
  return <div className="h-32 animate-pulse rounded-[24px] border border-slate-200/80 bg-white/85" />;
}

export default function AppLoading() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-72 animate-pulse rounded bg-slate-200" />
      </div>

      <div className="h-24 animate-pulse rounded-[24px] border border-slate-200/80 bg-white/85" />

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
