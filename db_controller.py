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
            processed_count INTEGER DEFAULT 0,
            total_count INTEGER DEFAULT 0
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
        
        sql_rank_urls = """	
        CREATE TABLE IF NOT EXISTS rank_urls (	
            rank_url_id INTEGER NOT NULL,
            against_query_id INTEGER NOT NULL,
            rank INTEGER NOT NULL,
            rank_date DATE
            );	
        """	
        self._execute_query(sql_rank_urls)

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
    
    def get_url_id(self,url):
        sql = """	
        SELECT id FROM visited_urls WHERE url=?	
        """	
        return self._execute_query(sql, (url,)).fetchone()[0]	
    
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
    	
    def update_query_processed_count(self, query, count):	
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
    
    def get_query_id(self,query):
        sql = """	
        SELECT id FROM query_info WHERE query=?	
        """	
        return self._execute_query(sql, (query,)).fetchone()[0]	
        
    
    
    # These below two functions are for total_count of urls as marcos said to store and retrive
    def update_query_total_count(self, query, total_count):	
        logger.debug(f"storing: {total_count}, query: {query}")	
        sql = ''' UPDATE query_info	
              SET total_count = ? 	
              WHERE query = ?'''	
        return self._execute_query(sql, (total_count, query))	
    	
    def get_total_count(self, query):	
        sql = """	
        SELECT total_count FROM query_info WHERE query=?	
        """	
        return self._execute_query(sql, (query,)).fetchone()[0]	
    
    
    
    
    # These below two functions are for resource_urls against particular url to store and retrive	
    def get_resource_urls(self,url):
        #url = "http%3A%2F%2Fkrwi.patchricami.it%2Fzpacks-tent.html"
        url_id = self.get_url_id(url)
        #print(url_id)
        sql = """	
        SELECT resource_url FROM resource_urls WHERE url_id=?	
         """	
        #return self._execute_query(sql, (url_id,)).fetchone()[0]	
        return self._execute_query(sql, (url_id,))
    
    def set_resource_url(self,url,resource_url):
        url_id = self.get_url_id(url)
        sql = """	
                INSERT INTO resource_urls (url_id,resource_url)	
                VALUES(?, ?);	
                """	
        return self._execute_query(sql, (url_id, resource_url)).lastrowid	
    
   
    
   
    def get_query_date(self, query):	
        sql = """	
        SELECT query_date FROM query_info WHERE query=?	
        """	
        return datetime.strptime(self._execute_query(sql, (query,)).fetchone()[0], "%Y-%m-%d %H:%M:%S.%f")
