import asyncio
import os
import asyncpg
import getpass

# Homebrew sets the superuser to your macOS login username
user = getpass.getuser()
DATABASE_URL = os.getenv("DATABASE_URL", f"postgresql://{user}@localhost:5432/ironstream")
DEFAULT_URL = os.getenv("DEFAULT_URL", f"postgresql://{user}@localhost:5432/postgres")

async def init():
    print(f"[DB] Connecting to PostgreSQL as user '{user}'...")
    try:
        # Connect to default 'postgres' db to ensure 'ironstream' database exists
        conn = await asyncpg.connect(DEFAULT_URL)
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = 'ironstream'")
        if not exists:
            await conn.execute("CREATE DATABASE ironstream;")
            print("[DB] Created 'ironstream' database successfully.")
        await conn.close()

        # Connect to 'ironstream' and create schema/hypertable
        conn = await asyncpg.connect(DATABASE_URL)
        print("[DB] Connected to 'ironstream'. Setting up tables...")
        
        # Enable TimescaleDB extension if available
        try:
            await conn.execute("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;")
        except Exception as ext_err:
            print(f"[DB-NOTE] TimescaleDB extension note: {ext_err}")

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS sensor_metrics (
                time TIMESTAMPTZ NOT NULL,
                device_id TEXT NOT NULL,
                temperature DOUBLE PRECISION,
                vibration DOUBLE PRECISION,
                is_fault BOOLEAN DEFAULT FALSE,
                raw_payload TEXT
            );
        """)
        
        try:
            await conn.execute("SELECT create_hypertable('sensor_metrics', 'time', if_not_exists => TRUE);")
            print("[DB] TimescaleDB hypertable configured successfully!")
        except Exception as e:
            print(f"[DB-NOTE] Hypertable setup note: {e}")
            
        await conn.close()
    except Exception as e:
        print(f"[DB-ERROR] Setup failed: {e}")

if __name__ == "__main__":
    asyncio.run(init())

