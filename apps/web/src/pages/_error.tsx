import type { NextPageContext } from "next";

type ErrorPageProps = {
  statusCode: number;
};

function ErrorPage({ statusCode }: ErrorPageProps) {
  return (
    <main style={{ padding: "2rem", textAlign: "center" }}>
      <h1>{statusCode}</h1>
      <p>Something went wrong.</p>
    </main>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext): ErrorPageProps => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 500;
  return { statusCode };
};

export default ErrorPage;
