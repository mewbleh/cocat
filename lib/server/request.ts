import { CoCatError } from "@/lib/server/errors";

export async function readJsonRequest(request: Request) {
  try {
    return await request.json();
  } catch (error) {
    throw new CoCatError("BAD_REQUEST", "The request body must be valid JSON.", error);
  }
}
