from py_clob_client.client import ClobClient
from dotenv import load_dotenv
import os

load_dotenv()

client = ClobClient(
    "https://clob.polymarket.com",
    key=os.getenv("POLYMARKET_PRIVATE_KEY"),
    chain_id=137,
    signature_type=1,
    funder=os.getenv("POLYMARKET_WALLET_ADDRESS")
)

creds = client.create_or_derive_api_creds()
print(f"API_KEY: {creds.api_key}")
print(f"API_SECRET: {creds.api_secret}")
print(f"PASSPHRASE: {creds.api_passphrase}")
