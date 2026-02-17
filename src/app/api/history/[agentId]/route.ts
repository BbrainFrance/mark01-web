import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";

const MARK2_API_URL = process.env.MARK2_API_URL || "http://76.13.42.188:3456";
const MARK2_API_KEY = process.env.MARK2_API_KEY || "";

const mark2Headers = {
  "Authorization": `Bearer ${MARK2_API_KEY}`,
  "Content-Type": "application/json",
};

// GET - Proxy vers Mark2 /history/:agentId
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!(await verifyAuth(token))) {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  const { agentId } = await params;
  const limit = req.nextUrl.searchParams.get("limit") || "100";

  try {
    const res = await fetch(`${MARK2_API_URL}/history/${agentId}?limit=${limit}`, {
      headers: mark2Headers,
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: `Proxy history error: ${e instanceof Error ? e.message : "inconnue"}` },
      { status: 502 }
    );
  }
}

// DELETE - Proxy vers Mark2 DELETE /history/:agentId
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!(await verifyAuth(token))) {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  const { agentId } = await params;

  try {
    const res = await fetch(`${MARK2_API_URL}/history/${agentId}`, {
      method: "DELETE",
      headers: mark2Headers,
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: `Proxy history delete error: ${e instanceof Error ? e.message : "inconnue"}` },
      { status: 502 }
    );
  }
}
