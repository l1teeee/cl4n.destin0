import { testDatabaseUrl } from "../helpers/test-db";

process.env.DATABASE_URL = testDatabaseUrl().toString();
process.env.APP_ENV = "test";
