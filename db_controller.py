#!/usr/bin/env python
# -*- coding: utf-8 -*-'

import sqlite3
from sqlite3 import Error

from util import get_logger
from datetime import datetime

logger = get_logger("cdn")


class DBController:
    db_path = "single_domain.db"

    def __init__(self):
        super(DBController, self).__init__()
        self.setup_db()

    def setup_db(self):
        self.create_table()

    def _execute_query(self, sql, values=None):
        try:
            conn = self.get_connection()
            cur = conn.cursor()
            if not values:
                cur.execute(sql)
            else:
                cur.execute(sql, values)
            conn.commit()
            return cur
        except Error as e:
            print(f"DB ERROR: {e}")
            logger.exception(e)

    def get_connection(self):
        conn = None
        try:
            conn = sqlite3.connect(self.db_path)
        except Error as e:
            print(f"DB ERROR: {e}")
            logger.exception(e)
        return conn

    def create_table(self):
        logger.debug("creating url table if not exist.")
        sql = """
        CREATE TABLE IF NOT EXISTS visited_urls (
            url text PRIMARY KEY,
            begin_date text NOT NULL,
            mark INTEGER DEFAULT 0
        );
        """
        self._execute_query(sql)

    def mark_url(self, url, mark=1):
        logger.debug(f"marking: {mark}, url: {url}")
        sql = ''' UPDATE visited_urls
              SET mark = ? 
              WHERE url = ?'''
        return self._execute_query(sql, (mark, url))

    def get_visited(self, url):
        sql = """
        SELECT * FROM visited_urls WHERE url=?
        """
        return self._execute_query(sql, (url,)).fetchone()

    def add_visited_url(self, url):
        if self.get_visited(url):
            return
        logger.debug(f"inserting in db url: {url}")
        sql = """
            INSERT INTO visited_urls (url,begin_date)
            VALUES(?, ?);
        """
        return self._execute_query(sql, (url, datetime.now())).lastrowid
