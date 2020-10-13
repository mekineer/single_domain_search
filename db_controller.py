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
        sql_visited_urls = """
        CREATE TABLE IF NOT EXISTS visited_urls (
            id INTEGER NOT NULL PRIMARY KEY,
            url text ,
            begin_date text NOT NULL,
            mark INTEGER DEFAULT 0
        );
        """
        self._execute_query(sql_visited_urls)	
        sql_query_Info = """	
        CREATE TABLE IF NOT EXISTS query_Info (	
            id INTEGER NOT NULL PRIMARY KEY,
            query text ,	
            query_date DATE,	
            processed_count INTEGER DEFAULT 0	
        );	
        """	
        self._execute_query(sql_query_Info)
        sql_resource_urls = """	
        CREATE TABLE IF NOT EXISTS resource_urls (	
            url_id INTEGER NOT NULL,	
            resource_url text	
        );	
        """	
        self._execute_query(sql_resource_urls)

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
   # ""///////////////////////////////////////new content to db //////////////////////////""	
    	
    def get_searched(self, query):	
        sql = """	
        SELECT * FROM query_info WHERE query=?	
        """	
        return self._execute_query(sql, (query,)).fetchone()	
    	
    def add_query_info(self, query):	
        if self.get_searched(query):	
             sql = ''' UPDATE query_info	
              SET query_date = ? 	
              WHERE query = ?'''	
             return self._execute_query(sql, (datetime.now(), query))	
        else:	
            logger.debug(f"inserting in db query: {query}")	
            sql = """	
                INSERT INTO query_info (query,query_date)	
                VALUES(?, ?);	
                """	
            return self._execute_query(sql, (query, datetime.now())).lastrowid	
    	
    def update_query_count(self, query, count):	
        logger.debug(f"storing: {count}, query: {query}")	
        sql = ''' UPDATE query_info	
              SET processed_count = ? 	
              WHERE query = ?'''	
        return self._execute_query(sql, (count, query))	
    	
    def get_processed_count(self, query):	
        sql = """	
        SELECT processed_count FROM query_info WHERE query=?	
        """	
        return self._execute_query(sql, (query,)).fetchone()[0]	
    	
    def get_query_date(self, query):	
        sql = """	
        SELECT query_date FROM query_info WHERE query=?	
        """	
        return datetime.strptime(self._execute_query(sql, (query,)).fetchone()[0], "%Y-%m-%d %H:%M:%S.%f")
