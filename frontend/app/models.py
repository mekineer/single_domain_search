from django.db import models

class QueryInfo(models.Model):
	query = models.CharField(max_length=200)
	query_date = models.DateTimeField(auto_now_add=True)
	processed_count = models.IntegerField(default=0)

	class Meta:
		db_table = 'query_info'

class VisitedUrls(models.Model):
	url = models.CharField(max_length=500)
	begin_date = models.DateTimeField(auto_now_add=True)
	mark = models.IntegerField(default=0)

	class Meta:
		db_table = 'visited_urls'
