import logging

from app.same_sky_matching import run_worker

logging.basicConfig(level=logging.INFO)

if __name__ == "__main__":
    run_worker()
