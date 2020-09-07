import logging


def get_logger(logger_name, level=logging.DEBUG):
    logger = logging.getLogger(logger_name)
    logger.setLevel(level)
    logging.basicConfig(
        filemode="w",
        filename="scdn.log",
        format="[%(asctime)s][%(levelname)s]: %(message)s"
    )
    return logger
