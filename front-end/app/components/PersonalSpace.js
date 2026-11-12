import Feed from "./Feed";

export default function PersonalSpace({ user, embedded = false }) {
  const Container = embedded ? "div" : "main";
  return <Container className={`personal-space mx-auto max-w-3xl ${embedded ? "" : "px-4 py-8"}`}>
    <div className="mb-6 w-full">
      {!embedded && <p className="font-note text-3xl leading-none">hey @{user.username}</p>}
      {embedded ? <h2 className="font-display text-4xl font-extrabold leading-none">Your space</h2> : <h1 className="font-display text-4xl font-extrabold leading-none">Your space</h1>}
      <p className="mt-2 text-sm font-semibold text-ink/70">Your posts and confessions, all in one place.</p>
    </div>
    <Feed user={user} />
  </Container>;
}
