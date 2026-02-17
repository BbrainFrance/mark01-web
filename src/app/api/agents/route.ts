import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";

const MARK2_API_URL = process.env.MARK2_API_URL || "http://76.13.42.188:3456";
const MARK2_API_KEY = process.env.MARK2_API_KEY || "";

const mark2Headers = {
  "Authorization": `Bearer ${MARK2_API_KEY}`,
  "Content-Type": "application/json",
};

// GET - Proxy vers Mark2 /agents (liste des agents)
export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!(await verifyAuth(token))) {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  try {
    const res = await fetch(`${MARK2_API_URL}/agents`, {
      headers: mark2Headers,
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: `Proxy agents error: ${e instanceof Error ? e.message : "inconnue"}` },
      { status: 502 }
    );
  }
}

// POST - Creer un nouvel agent via Mark2
export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!(await verifyAuth(token))) {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, label, description, system } = body;

    if (!id || !label) {
      return NextResponse.json({ error: "ID et label requis" }, { status: 400 });
    }

    const res = await fetch(`${MARK2_API_URL}/agents`, {
      method: "POST",
      headers: mark2Headers,
      body: JSON.stringify({ id, label, description, system }),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: `Erreur creation agent: ${e instanceof Error ? e.message : "inconnue"}` },
      { status: 502 }
    );
  }
}
