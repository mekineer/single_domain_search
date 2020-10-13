
from datetime import datetime
import logging
import os

home_path,file_name_ = os.path.split(os.path.realpath(__file__))
LOGFILE = os.path.join('scdn.log')

def get_logger(logger_name, level=logging.DEBUG):
    logger = logging.getLogger(logger_name)
    logger.setLevel(level)
    logging.basicConfig(
        filemode="w",
        filename=LOGFILE,
        format="[%(asctime)s][%(levelname)s]: %(message)s"
    )
    return logger