from django.db import models

class QueryInfo(models.Model):
	query = models.CharField(max_length=200)
	url = models.CharField(max_length=500,null=True,blank=True)
	query_date = models.DateTimeField(auto_now_add=True)
	processed_count = models.IntegerField(default=0)
	mark = models.BooleanField(default=False)

	class Meta:
		db_table = 'query_info'
		verbose_name_plural='Query Info'

	def __str__(self):
		return self.query
