export function CherryStatusScreen({
  message,
  role = "status",
}: {
  message: string;
  role?: "alert" | "status";
}) {
  return (
    <main className="flex h-dvh w-full items-center justify-center bg-white px-6 text-center text-black">
      <p className="max-w-sm text-[15px] text-black/60 leading-6" role={role}>
        {message}
      </p>
    </main>
  );
}
