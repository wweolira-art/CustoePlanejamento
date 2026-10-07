import { getOracleConnection } from "../../oracle.js";

export async function getConnection() {
  return getOracleConnection();
}
